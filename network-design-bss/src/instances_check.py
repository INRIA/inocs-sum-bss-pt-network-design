import pandas as pd
import os

if __name__ == '__main__':
    # 路径设置
    csv_path = "experiment_results_0618.csv"
    json_folder = "instances_json"

    all_txt_files = [f for f in os.listdir(json_folder) if f.endswith('.txt')]
    print(f"📁 Total JSON .txt files BEFORE deletion: {len(all_txt_files)}")

    # 读取 config 列
    df = pd.read_csv(csv_path)
    print("df length:", len(df))
    used_files = set(df['config'].astype(str) + ".txt")  # 加上 .txt 后缀

    # 扫描并删除对应的 JSON 文件
    deleted_count = 0
    for filename in os.listdir(json_folder):
        if filename in used_files:
            filepath = os.path.join(json_folder, filename)
            os.remove(filepath)
            print(f"Deleted: {filename}")
            deleted_count += 1

    remaining_files = [f for f in os.listdir(json_folder) if f.endswith('.txt')]
    print(f"🗑️  Deleted: {deleted_count}")
    print(f"📁 Remaining JSON .txt files AFTER deletion: {len(remaining_files)}")

    print("Cleanup completed.")

