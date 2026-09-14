"""
File: instance_attribute_extractor.py
Description: Functions for generating H3-based and grid-based synthetic instances
             used in bike-sharing network design experiments.

Author: Zhenyu Wu
Last Modified: 2025-11-13

Notes:
- This file contains two entry functions:
    (1) generate_h3_instances():   generate 1 realistic H3-based instance
    (2) generate_instances():      generate full parameter of synthetic instances
- These functions rely on InstanceGenerator for H3/grid construction.
"""

from input_handler.instance_generator import InstanceGenerator
from scenario.scenario_config import ScenarioConfig, DemandConfig, BudgetConfig
# from __future__ import annotations
import numpy as np


def generate_h3_instances():
    # 调用 instance 生成逻辑
    T = 3
    np.random.seed(30)
    scenario = ScenarioConfig(
        name="Geneva",
        demand_config=DemandConfig(
            seed=20,
            demand_periods=T,
            period_weights=tuple(np.random.dirichlet(np.ones(T))),
            split_method="multinomial"
        ),
        budget_config=BudgetConfig(
            total_budget=80000,
            op_budget_ratio=0.025,
        )
    )
    instance = InstanceGenerator(scenario)
    instance.build_realistic_scenario()
    instance.save_to_file("h3_instances_json")
    return instance
