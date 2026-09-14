import math

class CarBenchmark:
    def __init__(self, speed_kmh=50):
        """
        Initialize the benchmark with a constant car speed.
        """
        self.speed_kmh = speed_kmh  # Car speed in km/h

    def calculate_distance_and_time(self, origin_coords, destination_coords):
        """
        Calculate the distance and travel time between two coordinates.
        """
        # Euclidean distance
        distance = math.sqrt(
            (origin_coords[0] - destination_coords[0]) ** 2 +
            (origin_coords[1] - destination_coords[1]) ** 2
        )
        # Travel time in hours
        time = distance / self.speed_kmh * 60  # Convert to minutes
        return distance, time

    def calculate_od_matrix(self, grid):
        """
        Generate an OD matrix with distances and travel times for all zone pairs.
        """
        od_matrix = {}
        zones = grid.get_all_zones()
        for origin in zones:
            for destination in zones:
                if origin != destination:
                    origin_coords = grid.get_center(origin)
                    destination_coords = grid.get_center(destination)
                    distance, time = self.calculate_distance_and_time(origin_coords, destination_coords)
                    od_matrix[(origin, destination)] = {"distance": distance, "time": time}
        return od_matrix


# Example Usage
if __name__ == "__main__":
    # Create a 10x10 grid with 1 km cells
    grid = Grid(n=10, cell_size=1.0)

    # Initialize CarBenchmark with a car speed of 50 km/h
    benchmark = CarBenchmark(speed_kmh=50)

    # Calculate OD matrix
    od_matrix = benchmark.calculate_od_matrix(grid)

    # Print a few OD pairs
    for od, values in list(od_matrix.items())[:5]:  # Show first 5 OD pairs
        print(f"OD Pair {od}: Distance = {values['distance']:.2f} km, Time = {values['time']:.2f} minutes")