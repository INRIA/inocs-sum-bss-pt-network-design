#!/bin/bash

#OAR -p cluster='chirop'
#OAR -l nodes=2,walltime=3:00:00
#OAR -n parallel_python_main
#OAR -O output.log
#OAR -E error.log

# 项目路径
PROJECT_DIR="$HOME/pythonProject"

# 进入项目目录
cd "$PROJECT_DIR" || exit 1

# 准备 logs 和输入文件列表
mkdir -p logs
find instances_json -type f -name '*.txt' > fichiers_a_traiter.txt
# 显式排序 否则 parallel 可能会随机处理文件 run 的 instances 非常随机
# 两个 node 是交替执行的，但执行开始时间、运行时间不同
#find instances_json -type f -name '*.txt' | sort > fichiers_a_traiter.txt

# 日志
LOG_TRAITEMENT="logs/noeuds_par_fichier.log"
> "$LOG_TRAITEMENT"

# 使用 parallel 分发任务（每个 node 上 source venv）
parallel --ssh oarsh \
         --sshloginfile "$OAR_NODEFILE" \
         --jobs 1 \
         --workdir "$PROJECT_DIR" \
         --tag \
         "source $PROJECT_DIR/.venv/bin/activate && echo '[$(hostname)] Processing {}' >> $LOG_TRAITEMENT && python main.py {} > logs/{/.}.out 2> logs/{/.}.err" \
         :::: fichiers_a_traiter.txt

echo "OAR 作业已完成！" | mail -s "📬 Grid5000: Python 批处理完成通知" zhenyu.wu@inria.fr

# timeout 3600 python main.py

##!/bin/bash
##OAR -n python_batch
##OAR -l nodes=20,walltime=02:00:00
##OAR -O stdout.log
##OAR -E stderr.log
#
#source .venv/bin/activate
#
#cd $OAR_WORKDIR
#
## 确保 logs 文件夹存在
#mkdir -p logs
#
## 准备实例文件列表
#find instances_json -name "*.txt" > fichiers.txt
#
## 并行执行，每个实例一个任务（通过 parallel + oarsh）
#parallel --ssh oarsh \
#         --sshloginfile "$OAR_NODEFILE" \
#         --jobs 1 \
#         --workdir "$PWD" \
#         --tag \
#         "echo 'Running {} on $(hostname)' >> logs/global.log && python3 main.py {} > logs/{/.}.out 2> logs/{/.}.err" \
#         :::: fichiers.txt
#
#echo "OAR 作业已完成！" | mail -s "📬 Grid5000: Python 批处理完成通知" zhenyu.wu@inria.fr



##!/bin/bash
##OAR -l nodes=2,walltime=00:02:00
##OAR -n julia_MyProgram
##OAR -O output.log
##OAR -E error.log
#
#module load julia
##cd $OAR_WORKDIR
#
#if [ ! -f monCode.jl ]; then
#    echo "Fichier monCode.jl introuvable"
#    exit 1
#fi
#
## On prépare la liste des fichiers
#find instances -type f -name '*.txt' > fichiers_a_traiter.txt
#
## Nombre de nœuds réservés
#NB_NOEUDS=$(uniq "$OAR_NODEFILE" | wc -l)
#
## Crée le dossier de logs
#mkdir -p logs
#
#
#LOG_TRAITEMENT="logs/noeuds_par_fichier.log"
#> "$LOG_TRAITEMENT"
#
## Traitement parallèle avec log individuel
#parallel --ssh oarsh \
#         --sshloginfile "$OAR_NODEFILE" \
#         --jobs 1 \
#         --env JULIA_DEPOT_PATH \
#         --workdir "$PWD" \
#         --tag \
#         "module load julia && echo '[$(hostname)] Traitement de {}' >> $LOG_TRAITEMENT && julia monCode.jl {} > logs/{/.}.out 2> logs/{/.}.err" \
#         :::: fichiers_a_traiter.txt

