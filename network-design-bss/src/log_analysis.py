import os
import pandas as pd
from datetime import datetime
import re
import re
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.interpolate import interp1d
import numpy as np
import shutil

"""
对 log 文件进行分析，针对运行时长超过 1800s 的日志进行筛选和统计。
分析这些 case 的 gap 变化情况，甚至可以做一个平均走势图

这些 log 通过 experiment results 的数量倒推找到 转移到新文件夹中 防止丢失弄乱
"""


def resample_gap_curve(time_list, gap_list, interval=10, max_time=3600):
    if len(time_list) < 2:
        return [], []

    # 创建插值函数（线性或其他方式）
    f = interp1d(time_list, gap_list, kind='previous', fill_value='extrapolate')

    # 生成等间隔时间点（0 到 max_time）
    time_uniform = np.arange(0, max_time + interval, interval)
    gap_uniform = f(time_uniform)

    return time_uniform.tolist(), gap_uniform.tolist()


def plot_gap_vs_time(log_path):
    times, gaps = parse_log_gap_vs_time(log_path)
    time_uniform, gap_uniform = resample_gap_curve(times, gaps, interval=10)

    if not times:
        print("未找到 gap 与时间数据")
        return

    plt.figure(figsize=(8, 5))
    sns.lineplot(x=times, y=gaps, marker="o")
    plt.title("Gap Reduction over Time (0–3600s)")
    plt.xlabel("Time (seconds)")
    plt.ylabel("Optimality Gap (%)")
    plt.grid(True)
    plt.tight_layout()
    plt.show()


def parse_log_gap_vs_time(log_path):
    time_list = []
    gap_list = []
    with open(log_path, 'r') as file:
        for line in file:
            match = re.search(r"([\d\.]+)\s*%\s+\-+\s+([\d\.]+)s", line)
            if match:
                gap = float(match.group(1))
                time = float(match.group(2))
                time_list.append(time)
                gap_list.append(gap)
    return time_list, gap_list


def sample_gap_by_intervals(time_list, gap_list, sample_points):
    sampled_gaps = []
    for t in sample_points:
        # 找出 t 之前的所有时间点
        candidates = [(gap_list[i], time_list[i]) for i in range(len(time_list)) if time_list[i] <= t]
        if candidates:
            # 取最近的前一项
            gap = candidates[-1][0]
        else:
            gap = None  # 没有记录，可能是起点太早
        sampled_gaps.append(gap)
    return sampled_gaps


def analyze_unimodal_logs(log_dir, log_files, output_plot="gap_summary.png"):
    # 定义采样时间点
    early_times = list(range(0, 181, 30))               # 前3分钟：每30秒
    later_times = list(range(480, 3601, 600))           # 后续：每10分钟（600s）
    all_times = early_times + later_times

    gap_curves = []

    for fname in log_files:
        path = os.path.join(log_dir, fname)
        time_list, gap_list = parse_log_gap_vs_time(path)
        sampled_gaps = sample_gap_by_intervals(time_list, gap_list, all_times)
        gap_curves.append(sampled_gaps)

    # 画图：每条曲线一组gap
    plt.figure(figsize=(12, 6))
    for g in gap_curves:
        plt.plot(all_times, g, marker='o', alpha=0.6)
    plt.xlabel("Time (s)")
    plt.ylabel("MIP Gap (%)")
    plt.title("Gap Trajectories for Unimodal Logs with Runtime > 1800s")
    plt.grid(True)
    plt.xticks(all_times, rotation=45)
    plt.savefig(output_plot)
    plt.show()


def analyze_and_plot_gap_summary(log_dir, log_files):
    # 关键时间点（单位：秒）
    sample_times = list(range(0, 181, 30)) + [360, 900]

    all_gap_series = []

    for fname in log_files:
        path = os.path.join(log_dir, fname)
        time_list, gap_list = parse_log_gap_vs_time(path)
        sampled = sample_gap_by_intervals(time_list, gap_list, sample_times)
        all_gap_series.append(sampled)

    # 转换为 NumPy 数组：shape = (num_logs, num_time_points)
    gap_array = np.array(all_gap_series, dtype=np.float64)

    column_names = [f"{t}s" for t in sample_times]
    # 创建 DataFrame
    df_gap = pd.DataFrame(gap_array, columns=column_names)
    df_gap.to_csv("unimodal_gap_summary.csv", index=False)

    # 计算每个时间点的统计量
    mean_gap = np.nanmean(gap_array, axis=0)
    std_gap = np.nanstd(gap_array, axis=0)
    min_gap = np.nanmin(gap_array, axis=0)
    max_gap = np.nanmax(gap_array, axis=0)

    # 绘图
    plt.figure(figsize=(8, 6))
    plt.plot(sample_times, mean_gap, label="Mean Gap", color="royalblue")
    plt.fill_between(sample_times, mean_gap - std_gap, mean_gap + std_gap, color="royalblue", alpha=0.2, label="±1 Std Dev")
    # 或者用 min/max：
    # plt.fill_between(sample_times, min_gap, max_gap, color="lightblue", alpha=0.3, label="Min-Max Range")

    # 获取收敛值（最后一个时间点的平均 gap）
    final_gap = mean_gap[-4]
    print(f"Final average gap at convergence: {final_gap:.4f}%")

    # 画出红色虚线
    # plt.axhline(y=final_gap, color='red', linestyle='--', linewidth=1.2, label=f"Average Gap at 150 seconds = {final_gap:.2f}%")
    # plt.text(x=0 - 0.5, y=final_gap, s=f"{final_gap:.2f}%", va='center', ha='right', fontsize=10, color='red')
    plt.plot([0, 150], [final_gap, final_gap], color='red', linestyle='--', linewidth=1.5,
             label=f"Average Gap at 150 seconds = {final_gap:.2f}%")

    plt.xlabel("Time (s)")
    plt.ylabel("MIP Gap (%)")
    plt.title("Average Gap Trajectory (Unimodal, Runtime > 1800s)")
    plt.xticks(sample_times, rotation=45)
    plt.grid(True)
    plt.legend()
    plt.tight_layout()
    plt.savefig("gap_summary_plot.png")
    plt.show()


if __name__ == '__main__':
    """'gurobi_log_20250524_235653.txt'
    到 gurobi_log_20250602_150415.txt"""
    runtime_threshold = 1800
    csv_path = "experiment_results_COV0.5_0602.csv"  # 替换为实际的 CSV 文件路径
    df = pd.read_csv(csv_path)
    num_logs_expected = len(df)
    print(f"Number of logs expected: {num_logs_expected}")

    log_dir = "data/output/model_log"

    log_files = [f for f in os.listdir(log_dir) if f.startswith("gurobi_log_") and f.endswith(".txt")]

    def extract_datetime(fname):
        dt_str = fname.replace("gurobi_log_", "").replace(".txt", "")
        return datetime.strptime(dt_str, "%Y%m%d_%H%M%S")

    log_files_sorted = sorted(log_files, key=extract_datetime, reverse=True)
    # print(log_files_sorted)

    # === 取最近 N 个并正序排列 ===
    selected_logs = sorted(log_files_sorted[:num_logs_expected])
    # print(f"Selected logs: {selected_logs}")

    # logs_dir_copy = "data/output/model_log_copy"  # 备份目录
    long_logs_dir = "long_logs_extracted"        # 新文件夹名称（自动创建）
    # 自动创建存储长日志的新文件夹
    os.makedirs(long_logs_dir, exist_ok=True)
    # os.makedirs(logs_dir_copy, exist_ok=True)

    # 匹配 Gurobi 输出中的 runtime 行（例如：Explored ... in 1823.45 seconds）
    runtime_pattern = re.compile(r"in ([\d\.]+) seconds")

    long_logs = []
    for fname in selected_logs:  # ✅ 只遍历你已选定的 log 文件名
        path = os.path.join(log_dir, fname)
        # new_path = os.path.join(logs_dir_copy, fname)
        # shutil.copy(path, new_path)
        with open(path, "r") as f:
            content = f.read()
            match = runtime_pattern.search(content)
            if not match:
                print(f"Runtime pattern not found in {fname}")
            if match:
                runtime = float(match.group(1))
                if runtime >= runtime_threshold:
                    long_logs.append((fname, runtime))
                    # ✅ 拷贝文件到新目录
                    new_path = os.path.join(long_logs_dir, fname)
                    shutil.copy(path, new_path)
                # else:
                #     print(runtime_threshold - runtime, "seconds less than threshold")

    print(f"Number of logs with runtime > {runtime_threshold} seconds: {len(long_logs)}")
    long_logs.sort(key=lambda x: x[1], reverse=True)
    print(long_logs)

    # analyze_unimodal_logs(log_dir="long_logs_extracted", log_files=[f[0] for f in long_logs])

    analyze_and_plot_gap_summary(
        log_dir="long_logs_extracted",
        log_files=[f[0] for f in long_logs]  # 或你整理好的文件名列表
    )

    # log_file_path = "data/output/model_log/" + str(long_logs[10][0])  # 替换为你的log文件路径
    # plot_gap_vs_time(log_file_path)









