from abc import ABC, abstractmethod
from typing import Optional

import gurobipy as gp
from gurobipy import GRB
import logging
import datetime
import sys
from util.util import *
import os


class AbstractModel(ABC):

    def __init__(self):
        self.y: Optional[gp.tupledict] = None
        self.w: Optional[gp.tupledict] = None
        self.v: Optional[gp.tupledict] = None
        self.B: Optional[set] = None
        self.fixed_design = None
        self.solve_mode = None
        self.solver_stats = None
        self.dispatch_cost_expr = None
        self.total_flow_expr = None

    def __int__(self):
        self.model = gp.Model('abc')
        self.solve()
        return

    def solve(self):
        self._set_sets()
        self._set_parameters()
        self._set_variables()
        self._set_objective()
        self._set_constraints()
        self._apply_fixed_design()
        self._optimize()
        # self.solver_stats = self._optimize_two_stage()
        if not self._is_feasible():
            return self._process_infeasible_case()
        else:
            self._save_json()
            return self._post_process()

    def _set_sets(self):
        # pass
        print("Setting default parameters...")

    def _set_parameters(self):
        # pass
        print("Setting default parameters...")

    def _set_variables(self):
        # pass
        print("Setting default parameters...")

    def _set_objective(self):
        # pass
        print("Setting default parameters...")

    def _set_constraints(self):
        # pass
        print("Setting default parameters...")

    def _optimize(self):
        # Optimize the model
        today_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        log_filename = f"gurobi_log_{today_str}.txt"
        self.today_str = today_str
        # self.model.write(add_output_cwd(f"model_{today_str}.lp", "model_lp"))
        # 识别不可行约束子集 (IIS)
        # self.model.computeIIS()
        with open(add_output_cwd(log_filename, "model_log"), "w") as log_file:
            self.model.setParam(GRB.Param.TimeLimit, getattr(self, "time_limit", 3600))
            self.model.setParam('MIPGap', OPTIMALITY_GAP)  # 设置最优间隙
            print("🔍 TimeLimit parameter:", self.model.getParamInfo(GRB.Param.TimeLimit)[2])
            # self.model.setParam("Heuristics", 0.1)  # 10% 时间用于启发式搜索(越大启发式越增强 未必越快)
            # self.model.setParam("MIPFocus", 1)  # 更关注找到可行解
            # self.model.setParam("MIPFocus", 2)  # 更关注证明最优性
            self.model.setParam("Method", 3)  # 3 表示 Network Simplex 适用于 网络流量问题 初步尝试有提升
            sys.stdout = log_file  # 将 stdout 输出到日志文件
            self.model.optimize()
            sys.stdout = sys.__stdout__  # 还原默认输出
        print("---------------------------")
        self.model.printStats()
        print("---------------------------")

    def _optimize_two_stage(self):

        today_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.today_str = today_str
        # =========================
        # Stage 1
        # =========================

        self.model.ModelSense = GRB.MAXIMIZE
        self.model.setObjective(self.total_flow_expr)

        self.model.setParam(GRB.Param.TimeLimit, getattr(self, "time_limit", 3600))
        self.model.setParam(GRB.Param.MIPGap, OPTIMALITY_GAP)

        self.model.optimize()

        if self.model.SolCount == 0:
            return

        stage1_has_sol = self.model.SolCount > 0

        stage1 = {
            "status": self.model.Status,
            "obj_val": float(self.model.ObjVal) if stage1_has_sol else None,
            "obj_bound": float(self.model.ObjBound) if stage1_has_sol else None,
            "gap": float(self.model.MIPGap) if stage1_has_sol else None,
            "runtime": float(self.model.Runtime),
        }

        maximum_flow = self.model.ObjVal

        # =========================
        # Stage 2
        # =========================

        # 锁定 flow
        self.flow_lock = self.model.addConstr(
            self.total_flow_expr >= maximum_flow - 1e-6,   # - 1e-6,
            name="lock_flow"
        )

        if TWO_STAGE_CONSIDERED:

            self.model.ModelSense = GRB.MINIMIZE
            self.model.setObjective(self.dispatch_cost_expr)

            self.model.setParam(GRB.Param.TimeLimit, getattr(self, "time_limit", 3600))

            self.model.optimize()

            stage2_has_sol = self.model.SolCount > 0

            stage2 = {
                "status": self.model.Status,
                "obj_val": float(self.model.ObjVal) if stage2_has_sol else None,
                "obj_bound": float(self.model.ObjBound) if stage2_has_sol else None,
                "gap": float(self.model.MIPGap) if stage2_has_sol else None,
                "runtime": float(self.model.Runtime),
            }

        else:
            stage2 = {
                "status": None,
                "obj_val": None,
                "obj_bound": None,
                "gap": None,
                "runtime": None,
            }

        return {
            "two_stage": True,
            "stage1": stage1,
            "stage2": stage2,
            "stage1_best_flow": maximum_flow,
        }

    def _is_feasible(self):
        # Check if the solution is feasible
        return self.model.status == GRB.OPTIMAL

    def _process_infeasible_case(self):
        # Process the infeasible case
        print("No feasible solution found.")
        return None

    def _post_process(self):
        pass

    def _save_json(self):
        # 结果存入 json 方便做细致分析
        pass

    def _apply_fixed_design(self):
        if self.solve_mode == "sequential_stage2":
            if self.fixed_design is None:
                raise ValueError("fixed_design must be provided for sequential_stage2")

            # 1) Fix ONLY station-opening decisions (y).
            #    w and v1 are NOT fixed: the LP oracle's values are continuous
            #    and rounding them to integers may yield no integer-feasible
            #    operational plan.  Instead, we let Gurobi jointly optimise
            #    w, v1, and all operational variables given the fixed y.
            for i, val in self.fixed_design["y"].items():
                val = int(round(val))
                self.y[i].LB = val
                self.y[i].UB = val

            # 2) Use LP-optimal w and v1 as MIP start hints so Gurobi can
            #    warm-start from a near-feasible point.
            for i, val in self.fixed_design.get("w", {}).items():
                hint = int(round(val))
                if hint > 0:
                    self.w[i].Start = hint

            for i, val in self.fixed_design.get("v1", {}).items():
                hint = int(round(val))
                if hint > 0:
                    self.v[i, 0].Start = hint

            self.model.update()
            print("=== Sequential stage 2: fixed design variables applied ===")
