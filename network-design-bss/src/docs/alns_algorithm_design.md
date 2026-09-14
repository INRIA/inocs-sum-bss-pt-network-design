# ALNS 求解算法设计文档

本文档描述 `alns_solver/` 的算法实现本身（做了什么、为什么这样做）。实验结果、性能数据、已发现的问题见 `docs/alns_vs_gurobi_scale_test.md`；本文档只讲算法结构。

## 1. 问题分解

BSS 网络设计问题的决策变量分两层：

- **战略层**：`y[i] ∈ {0,1}`（站点 i 是否建）、`w[i]`（站点容量/dock 数）、`v1[i]`（初始车队/库存）。三者通过同一条预算约束耦合：`cs·y + cp·w + cu·v1 ≤ Q`（`model/constraints.py:296-300`）。
- **运营层**：给定战略层决策后，流量分配 `x_b/x_pt/x_w`（每个 OD-时段-路径的流量）、自行车弧流量 `f`、调度流量 `r`、调度车辆数 `n`、各周期库存 `v[i,t](t≥1)`。这一层的约束包含跨周期库存链式方程 `v[i,t]=v[i,t-1]-...`（`model/constraints.py:238`）。

**核心设计决策：ALNS 只在 y（开哪些站）这个组合空间上搜索；w、v1 和全部运营变量交给下层 oracle 精确/近似联合求解。** 理由：给定 y 之后，(w, v1, 运营变量) 的联合优化在 Gurobi 上是毫秒到秒级就能精确解出的资源分配问题（LP 松弛根节点 gap 普遍 <0.3%，见效果文档第 2 节），把它们也塞进元启发式的离散搜索空间只会指数级放大搜索规模，换不来精度收益。

## 2. 整体流程

```
ProblemContext（一次性）
   │  网络、k-最短路、demand_matrix、arc_to_paths 等静态数据
   ▼
PersistentOperationalModel（每次 ALNS 运行一次）
   │  set_variables + set_constraints + set_objective，y 先设为自由二元变量
   ▼
run_alns(context, oracle_fn, config, pool)
   │  destroy → repair → oracle 评估 → 接受/拒绝 → 自适应权重更新，循环直到停止
   ▼
best_design（y 的最优子集，近似解）
   │
   ▼
solve_mip_gurobi(pool, best_design)  ← 精确收尾
   │  固定 y，跑一次完整 MIP，得到可直接与"直接求解"比较的精确目标值
   ▼
最终报告的目标值
```

代码文件对应：

| 文件 | 职责 |
|---|---|
| `context.py` | 一次性构建静态问题数据（`ProblemContext`） |
| `oracles.py` | 下层子问题的三种求解器 + 持久化模型 |
| `design.py` | Design 表示（开放站点集合）与预算可行性估计 |
| `operators.py` | destroy/repair 算子 |
| `alns.py` | ALNS 主循环（自适应权重 + 模拟退火） |
| `benchmark.py` | 对比实验编排脚本 |
| `parallel.py` | 多进程并行跑多条独立种子的 ALNS 链，取最优 |

## 3. 下层 oracle：给定 y，求解运营子问题

三种互相替代的实现，全部复用 `model.variables.set_variables` / `model.constraints.set_constraints` / `model.objective.set_weighted_multi_objective`（不重新推导约束，只是在"固定 y"之后调用，降低出错风险）：

### 3.1 `solve_mip_gurobi`

固定 y 的上下界（`PersistentOperationalModel.set_design`），跑一次完整 MIP（`model.optimize()`，可传 `time_limit`/`mip_gap`/`warm_hints`）。用于：(a) ALNS 找到最优 y 之后的精确收尾；(b) 也可作为 ALNS 内部的下层 oracle（每次候选设计都精确求解），但由于给定 y 后模型仍是 MIP，逐次调用的耗时会随问题规模显著上升（小算例几十毫秒，某些大算例可到几十秒，见效果文档 5.3 节）。

### 3.2 `solve_lp_gurobi`（默认 ALNS oracle）

固定 y 之后，把整个模型 `.relax()` 成纯 LP（所有整数/二进制变量放松为连续），用 Gurobi 单纯形/内点法求解，不走分支定界。由于给定 y 后的 LP 松弛根节点 gap 通常很小，这个近似值通常离精确 MIP 目标值不远，且求解极快。

### 3.3 `solve_lp_highs`

跟 3.2 完全相同的 LP（矩阵从 Gurobi 的 relaxed shell 里直接抽取），换用 SciPy 的 HiGHS 引擎求解（`scipy.optimize.linprog(method="highs")`）。用于对比"同一个数学问题，换开源求解引擎"的速度差异，不引入额外的近似误差。

### 3.4 调度固定成本的近似处理

调度车辆数 `n` 带固定成本（每派一辆车 `dispatch_fixed_cost`，与运了多少车无关），这在纯 LP 里没法直接表达（LP 只能是线性的）。两个 LP oracle 都先忽略这项固定成本（目标函数里只保留 `r × 单位距离成本` 的线性部分），求解完之后事后修正：

```
n = ceil(r / CAPACITY_REBALANCING_VEHICLE)         # 反推需要几辆车
obj_val -= epsilon * Σ(n × dispatch_fixed_cost)     # 补扣之前没算的固定成本
```

（`oracles.py::_repair_dispatch_fixed_cost`）。这只影响 ALNS 搜索过程中用来打分/排序候选设计的近似目标值；最终报告的目标值永远来自 `solve_mip_gurobi` 的一次精确收尾，这个近似不会污染最终结果。

## 4. 持久化模型：为什么、怎么做

**问题**：`set_variables`+`set_constraints` 在 Python 侧要循环调用几万次 `addVar`/`addConstr`，实测在基准小算例上耗时 ~3.4 秒；而实际求解（无论 MIP 还是 LP）只要 27-46 毫秒。朴素地"每次候选设计都重新建模+求解"，99% 以上的时间会浪费在重建一个结构其实没变的模型上——变的只是哪些 y 被固定成 0/1。

**做法**（`PersistentOperationalModel`）：

1. 构造时把 y 设为自由二元变量，跑一次 `set_variables`+`set_constraints`+`set_weighted_multi_objective`，之后终生不再重新调用——这是省下 ~3.4s/次的主要来源，对 `solve_mip_gurobi`、`solve_lp_gurobi`、`solve_lp_highs` 三者都成立。
2. `set_design(design)`：只改 `y[station].LB`/`UB`，`model.update()`，用于 `solve_mip_gurobi`（Gurobi 的 MIP 分支定界能有效利用上一次求解的信息热启动）。
3. `solve_lp_gurobi` 里，每次调用仍然对**持久化的 MIP 模型**调用一次 `model.relax()` 拿到全新的 LP 松弛副本再 `optimize()`——**这里特意不复用同一个 relax 副本反复改界求解**。原本以为"复用同一个 LP 副本、只改 y 上下界"能让 Gurobi 从上一次单纯形基热启动、更快，但实测做了 A/B 验证后发现恰好相反：复用副本比每次重新 `.relax()` 慢 4-5 倍（基准算例上约 115-150ms/次 vs 26ms/次）。推测原因是 Gurobi 的 presolve 只在"全新 relax 一个模型"时才会针对当前 y 的 0/1 状态做剪枝（比如 y=0 的站点会把它相关的容量、库存、流量变量和约束直接消掉，显著缩小实际求解规模）；反复在同一个已经求解过的模型对象上改界，反而拿不到这种"presolve 重新针对当前界做剪枝"的收益。**结论：省"重建模型"的钱要靠持久化 `set_variables`/`set_constraints`，不要靠复用同一个已 relax 的模型反复改界——后者是伪优化，实测是负收益。**
4. `_lp_arrays(pool)`：`solve_lp_highs` 走的是另一条路——从**一次性**构造的 relax 副本（`relaxed_shell()`，只用来读取约束矩阵/目标系数结构，从不在它上面重新 optimize）里把矩阵抽取一次并缓存，每次调用只需要复制并修改 y 对应的上下界数组喂给 `scipy.optimize.linprog`，不需要重新遍历几万个 Gurobi 变量/约束对象。这条路径不涉及"复用 Gurobi 自己内部求解状态"的问题（HiGHS 每次都是拿到矩阵后独立、从头 presolve+求解），所以矩阵结构缓存是有效优化，跟第 3 点的教训不冲突。

效果（基准小算例，`solve_lp_gurobi`）：单次调用延迟从重建模型的 ~3.4s 降到约 26ms（130 倍），`solve_mip_gurobi` 约 25-45ms，`solve_lp_highs`（含 scipy 侧开销）约 150-200ms——具体因 oracle 类型和问题规模而异（见效果文档第 1 节、第 3 节）。

## 5. ALNS 主循环

### 5.1 伪代码

```
station_score ← build_station_score(context)          # 静态先验：路径中心性打分
pool ← PersistentOperationalModel(context)

current_design ← max_coverage_greedy(∅)      # 初始解：最大覆盖贪心构造（默认，见第8节）
current_result ← oracle_fn(pool, current_design)
best_design, best_result ← current_design, current_result
temperature ← sa_start_temp_frac × |best_obj|

repeat（直到 max_iterations 或 no_improve_limit 或 max_time_seconds 触发）：
    d ← 按 destroy_weights 轮盘赌选一个摧毁算子
    r ← 按 repair_weights 轮盘赌选一个修复算子
    q ← round(destroy_frac × |current_design|)          # 本轮摧毁的站点数
    destroyed ← d(current_design, q, current_result.station_flow)
    candidate  ← r(destroyed, budget, station_score,
                    best_result.station_flow, best_result)  # oracle 真实反馈打分
    result ← oracle_fn(pool, candidate)                  # 命中缓存则跳过求解

    若 result.obj > best_obj:        接受，score=score_new_best，更新 best
    否则若 result.obj > current.obj: 接受，score=score_improved
    否则：                            以 exp(Δ/temperature) 概率接受（模拟退火）
                                      accepted → score=score_accepted
                                      否则     → score=score_rejected（=0）

    temperature ← temperature × sa_cooling_rate
    每 segment_size 轮，用本段累计的平均 score 更新 destroy_weights/repair_weights
                        （指数滑动平均：w ← (1-reaction_factor)·w + reaction_factor·avg_score）

return best_design, best_result
```

### 5.2 destroy 算子（`operators.py`）

| 算子 | 逻辑 |
|---|---|
| `random_removal` | 从当前开放站点里随机移除 q 个 |
| `worst_removal` | 按当前解里各站点的**实际流量贡献**（`station_flow`，来自上一次 oracle 结果）从低到高移除 q 个；没有历史流量数据时退化为随机移除 |
| `related_removal` | Shaw 风格：随机选一个"锚点"站点，移除离它地理距离最近的 q 个（含锚点自己） |

### 5.3 repair 算子（`operators.py`）

三个算子共享同一个打分函数 `combined_station_score`：

```
combined_score(s) = 0.7 × normalize(station_flow[s])          # 若已有 oracle 求解历史
                   + 0.3 × normalize(station_score[s])         # 静态路径中心性先验
```

`station_flow` 是 ALNS 当前"最优解"（`best_result`）里各站点的真实自行车弧流量贡献（`oracles.py::_station_flow_from_getter`）；`station_score` 是纯结构性的先验（某站点覆盖了多少条排名靠前的 k-最短路，与需求数据无关，`operators.py::build_station_score`），只在还没有任何 oracle 求解历史时（比如初始构造）或者某站点从未被打开过时起兜底作用。

| 算子 | 逻辑 |
|---|---|
| `greedy_insertion` | 按 `combined_score` 从高到低排序候选站点，逐个检查预算可行性后加入 |
| `regret2_insertion` | 每一步比较当前最高分和次高分的差值（"regret"），差值大就优先插入最高分那个，否则跳到次高分——避免每次都严格贪心导致的路径依赖 |
| `random_insertion` | 随机顺序遍历候选站点，可行则加入，用于给搜索引入多样性 |

**预算可行性估计**（`design.py::feasible_to_add`）：由于精确判断"加入这个站点后 w/v1 该怎么定还剩不剩预算"需要跑一次 oracle（太贵，不能对每个候选站点都跑一次），这里用一个**代理成本**做快速筛选：

```
typical_station_cost = cs + cp×CAPACITY_UB + cu×CAPACITY_UB   # 假设满容量、满库存
```

（曾经用过"最低容量"作代理，会导致几乎所有站点都"看似可负担"，repair 算子退化成"能加就全加"，见效果文档中提到的早期问题。改成假设满容量后，贪心构造出的初始站点数量能自然落在和真实最优解相近的量级。）当 `current_result` 已有真实 oracle 求解历史时，`realized_avg_station_cost` 会改用当前最优解里**实际观测到**的平均单站成本（`cs + cp×实际w + cu×实际v1`，只统计真正被打开的站点）替代这个静态假设，让预算筛选逐渐向真实解靠拢。

### 5.4 自适应权重（Ropke & Pisinger 风格）

每个 destroy/repair 算子维护一个权重，按权重做轮盘赌选择（`random.choices`）。每轮迭代按结果给算子记一个 score（新最优/改进/被接受但更差/被拒绝，四档递减），每 `segment_size` 轮用该段的平均 score 做指数滑动平均更新权重——用得多、效果好的算子后续被选中的概率会自适应升高。

### 5.5 模拟退火接受准则

- 找到新最优或改进当前解：无条件接受。
- 比当前解差：以 `exp(Δobj / temperature)` 的概率接受（Δobj 为负数，temperature 越高越容易接受较差的解，用于跳出局部最优）。
- `temperature` 初始为 `sa_start_temp_frac × |best_obj|`（不是固定绝对值——需要相对问题规模缩放，否则大规模问题下温度相对于目标值波动幅度过小，会退化成贪心爬山，见效果文档 3.2 节的教训），每轮乘以 `sa_cooling_rate` 衰减。

### 5.6 停止条件

三个条件任一触发即停止（`stop_reason` 记录具体原因，便于事后诊断）：

1. `max_iterations`：达到最大迭代次数。
2. `no_improve_limit`：连续这么多轮没有刷新过 `best_obj`，判定为收敛。
3. `max_time_seconds`：纯粹的兜底安全阀，不是目标预算——正常情况下应该由前两个条件先触发。

### 5.7 候选设计缓存

`run_alns` 内维护一个 `design(frozenset) → OracleResult` 的字典缓存。destroy+repair 有一定概率生成之前已经评估过的同一个站点集合（尤其 worst_removal + greedy_insertion 这种确定性组合容易收敛回同一个局部解），命中缓存直接复用结果，不重复调用 oracle。

## 6. 参数配置（`ALNSConfig`，`alns.py`）

| 字段 | 默认值 | 含义 |
|---|---|---|
| `max_iterations` | 2000 | 最大迭代轮数 |
| `max_time_seconds` | 3600.0 | 兜底时间安全阀（不是目标预算） |
| `no_improve_limit` | 400 | 连续多少轮无提升判定收敛 |
| `segment_size` | 25 | 自适应权重更新的分段长度 |
| `destroy_frac_min`/`_max` | 0.15 / 0.15 | 每轮摧毁站点数占比，从该区间采样（默认区间退化为固定值，见第 8 节 A/B 结论） |
| `stagnation_kick_every`/`_multiplier` | 0（关闭）/ 2.5 | 连续多少轮无提升就强制加码一次摧毁比例（默认关闭，见第 8 节） |
| `use_root_relaxation_prior` | False | 是否用根节点 LP 松弛的 y* 做初始构造先验（默认关闭，见第 8 节） |
| `use_max_coverage_construction` | True | 初始构造用最大覆盖贪心还是静态分数贪心（默认开启，见第 8 节） |
| `reaction_factor` | 0.3 | 自适应权重指数滑动平均的学习率 |
| `score_new_best/improved/accepted/rejected` | 5/3/1/0 | 四档 score，驱动权重更新 |
| `sa_start_temp_frac` | 0.15 | 初始温度 = 该比例 × 初始最优解目标值 |
| `sa_cooling_rate` | 0.999 | 每轮温度衰减系数 |
| `seed` | 42 | 随机种子（destroy/repair 选择、随机算子内部） |

这些参数在效果文档里被反复提及是"目前所有规模共用一套、没有随问题规模自适应"，是已知的优化方向之一，不在本文档范围内展开。

## 7. 已知的设计取舍（简要，详见效果文档）

- w/v1 不进搜索空间：理论上和实测上都验证是对的（效果文档 3.1 节的理论分析 + 5.2 节退化解证据都支持这个判断）。
- 三个 oracle 中默认用 `solve_lp_gurobi`：数学上是精确 LP（不像 HiGHS 版本引入额外的矩阵抽取环节），且在多数场景下比 MIP oracle 更快，但在个别规模下 MIP oracle（带 warm start）反而更快（效果文档 3 节），需要具体场景具体测。
- destroy/repair 目前只用"实现流量"这个一阶反馈，没有用 LP 对偶信息（影子价格）——这是下面第 8 节 A/B 测试之后仍然定位到的、优先级最高的下一步改进方向。

## 8. 六项改进提案的 A/B 验证结果

针对效果文档定位到的问题，逐条评估并实现了六项改进提案，全部在基准小算例（T=3，372 条真实 OD，5 个随机种子）上做 A/B 对比，部分额外在困难算例（T=8/50%，已知 gap 最差）上复核。方法论：每次只改一个变量，跟已确认更优的配置做对照，不靠单次运行下结论。

| # | 改进 | 默认状态 | 证据 |
|---|---|---|---|
| 1 | 需求加权路径分数（`build_station_score` 从数路径条数改成按 `(1-λπ)·demand` 加权求和） | **保留启用**，零成本、中性 | 跟旧分数在本实例上给出的站点排序高度相关，5 个种子里在"关闭②④⑥"的干净基线下没有可测差异；零成本，无下行风险 |
| 2 | 全模型根节点 LP 松弛（y 连续参与联合求解）作为初始构造先验 | **关闭**（`use_root_relaxation_prior=False`） | 5 个种子**全部**更差（平均 gap 1.77% vs 不用先验的 0.34%），且收敛更快——即更快卡住，不是探索不够。推测：y* 的分数值排序不代表真实边际价值（这正是第 5 条要解决的耦合问题），构造出的初始解"看起来权威"反而让后续搜索更难跳出该局部解 |
| 3 | 并行多链 ALNS（`parallel.py`，多进程独立跑不同种子，取最优） | **保留启用，本轮唯一压倒性正向改进** | 4 条链并行 65.85s（非 4×串行耗时）拿到 0.20% gap，单链最好只有 0.40%；已验证 academic license 允许多进程并发 |
| 4 | destroy_frac 随机化（固定 0.15 → 每轮从 [0.10,0.30] 采样） | **关闭**（`destroy_frac_min=max=0.15`） | 简单算例（T=3）和困难算例（T=8/50%）上都更差；T=8/50% 上把耐心预算（`no_improve_limit`）放宽到 3.75 倍依然追不平，排除了"只是耐心不够"的可能 |
| 5 | 边际覆盖增益贪心构造（`max_coverage_greedy`：每步选能让"当前所有可行路径的加权需求"边际增量最大的站点，而非静态分数最高的站点；单调子模、budget 约束下有 (1-1/e) 近似保证） | **初始构造用途已回退**，逻辑保留为自适应 repair 选项 | 在 T=3 上 5 个种子平均温和正向（0.338%→0.278%），但拿到 T=5 上单独 A/B（分数公式固定，只换构造方式）发现它**单独**把 gap 从 ~2%/~1.7% 翻倍到 ~4.5%/~4.3%，且新旧分数在两种构造下逐位数字相同——问题坐实在"硬性押注一次性构造"，不在打分公式。跟②的病理是同一类：构造给出的方案越"自信"，后续搜索越难跳出该局部解，只是这次换了个网络规模就现出原形。**处理方式**：不再作为 `use_max_coverage_construction`（默认 `False`）的一次性初始构造，改造成 `max_coverage_repair`——加入 `REPAIR_OPERATORS`，跟其它 repair 算子一样接受自适应权重的持续考核，效果好会被多选、效果差会被自然降权，不再有"一步选错、全程锁死"的风险。另外新增 `weak_support_removal`（按静态路径支撑度而非实现流量选移除对象）加入 destroy 池，同一逻辑。用这套最终配置在 T=5/6/7×3 密度重跑（见 `docs/alns_vs_gurobi_scale_test.md` 第 9 节）：9 组里 6 组质量更好（其中两组从"严重失败"拉回正常）、2 组打平、1 组轻微变差，平均 gap 5.18%→3.52%，总耗时腰斩——净改善。 |
| 6 | 停滞检测 + 强制大摧毁（连续 N 轮无提升就加倍 destroy_frac） | **关闭**（`stagnation_kick_every=0`） | 和第 4 条同批测试，同样在两种规模上都更差 |

**统一的反直觉发现**：②④⑥⑤（作为一次性硬性选择时）这四项"让搜索更聪明/更有活力"的改动全部失败，且在不同规模上表现一致（不是噪声）。共同的病理：**任何"一次性、硬性押注"的决策**（固定的构造方式、固定放大的扰动幅度）一旦选错，会把搜索锁死在一个更差的区域里出不来，而问题是否"选错"取决于具体实例（②⑤在 T=3 上看着还行，换到 T=5 就翻车）。相反，**能持续接受自适应权重考核的选项**（③独立多链取最优、把⑤降级为 `max_coverage_repair`）都是净正向——效果好自然多用，效果差自然被冷落，不会因为一次错误判断拖累全程。这是本文档最重要的架构教训：**给搜索"更多可以自适应选择的选项"，而不是替它"一次性做出更聪明的决定"**。
