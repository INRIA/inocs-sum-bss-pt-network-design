class Path:
    _id_counter = 0  # 用于分配唯一 ID

    def __init__(self, source, target, path, arcs_traversed, total_time,
                 total_distance, modes, shortest_path_time_gain=0):
        self.source = source  # 起点
        self.target = target  # 终点
        self.path = path  # 经过的所有节点
        self.arcs_traversed = arcs_traversed  # 使用的所有边
        self.total_time = total_time  # 总时间
        self.total_distance = total_distance  # 总距离
        self.modes = modes  # 使用的交通模式
        self.shortest_path_time_gain = shortest_path_time_gain  # 相对于调整前最短路径的时间增益
        self.id = Path._id_counter  # 赋予唯一 I
        Path._id_counter += 1  # 递增

        # 计算 delta：Arc 是否属于该 Path
        self.delta_dict = {arc: 1 for arc in self.arcs_traversed}

    def delta(self, arc):
        """返回某个 Arc 是否属于该路径"""
        return self.delta_dict.get(arc, 0)

    def __hash__(self):
        return hash(self.id)

    def __lt__(self, other):
        return self.total_time < other.total_time

    def __repr__(self):
        return (f"Path(source={self.source}, target={self.target}, total_time={self.total_time}, "
                f"total_distance={self.total_distance}, modes={self.modes})")
