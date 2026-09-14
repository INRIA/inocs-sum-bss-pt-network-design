import json
from util.util import *
import datetime


def save_gurobi_results(self, filename_prefix=f"gurobi_results"):
    """保存 Gurobi 变量求解结果到 JSON 文件"""
    # 获取当前日期（格式：YYYYMMDD）
    # today_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    today_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    self.today_str = today_str

    # 生成带日期的文件名
    filename = f"{filename_prefix}_{self.today_str}.json"

    results = {}

    # 读取所有变量的最优值
    for var in self.model.getVars():
        results[var.VarName] = var.X  # 保存变量名和最优值

    # 保存到 JSON 文件
    with open(add_output_cwd(filename, "model_result"), "w") as f:
        json.dump(results, f, indent=4)

    print(f"✅ Gurobi 结果已保存到 {filename}")
