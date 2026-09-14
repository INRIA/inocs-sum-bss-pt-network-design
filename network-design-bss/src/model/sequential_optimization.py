from model.bike_sharing_optimization import BikeSharingModel


def solve_sequential(network, shortest_path_solver, demand_generator, epsilon=None):
    # Stage 1: solve strategic design with zero operational budget
    model_stage1 = BikeSharingModel(
        network=network,
        shortest_path_solver=shortest_path_solver,
        demand_generator=demand_generator,
        epsilon=epsilon,
        solve_mode="sequential_stage1",
    )

    fixed_design = model_stage1.get_design_solution()

    # Stage 2: restore operational budget and optimize operations on fixed design
    model_stage2 = BikeSharingModel(
        network=network,
        shortest_path_solver=shortest_path_solver,
        demand_generator=demand_generator,
        epsilon=epsilon,
        solve_mode="sequential_stage2",
        fixed_design=fixed_design,
    )

    return model_stage1, model_stage2


def optimization_model_solver(demand_generator, epsilon, network_with_bss,
                              shortest_path_solver, solve_mode="integrated"):
    """
    Dispatch between solution strategies.

    solve_mode ∈ {"integrated", "sequential"}
    """
    if solve_mode == "integrated":
        bike_sharing_model = BikeSharingModel(network_with_bss, shortest_path_solver,
                                              demand_generator, epsilon)
    elif solve_mode == "sequential":
        _stage1, bike_sharing_model = solve_sequential(
            network_with_bss,
            shortest_path_solver,
            demand_generator,
            epsilon,
        )
    else:
        raise ValueError(
            f"Unknown solve_mode='{solve_mode}'. "
            f"Expected one of: 'integrated', 'sequential'."
        )
    return bike_sharing_model
