class Arc:
    def __init__(self, mode, start_node, end_node, distance, travel_time):
        self.mode = mode  # "bike" or "pt"
        self.start_node = start_node
        self.end_node = end_node
        # 在 Arc 中存储固定方向 （节省空间 ）
        # 确保 Arc 对象的方向是 (min(start, end), max(start, end))，并在比较时始终使用这个方向。不靠谱
        # self.start_node, self.end_node = sorted([start_node, end_node])
        self.distance = distance
        self.travel_time = travel_time

    def __lt__(self, other):
        return self.travel_time < other.travel_time

    def __repr__(self):
        return f"Arc({self.mode}, {self.start_node}, {self.end_node}, {self.distance} km, {self.travel_time})"


