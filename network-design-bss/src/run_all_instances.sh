#!/bin/bash

source .venv/bin/activate  # 如果使用虚拟环境
mkdir -p logs              # 创建日志目录

for instance in instances_json/*.txt
do
    name=$(basename "$instance" .txt)
    echo "Running $instance"
    python main.py "$instance" > logs/${name}.out 2> logs/${name}.err
done

deactivate