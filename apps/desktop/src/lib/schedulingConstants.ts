export const FSRS_ALGORITHM_NAME = "FSRS-6";
export const SM2_ALGORITHM_NAME = "SM-2";

export const FSRS6_DEFAULT_WEIGHTS: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

export const DECK_CONFIG_DEFAULTS = {
  algorithm: "fsrs" as const,
  new_per_day: 20,
  review_per_day: 200,
  desired_retention: 0.9,
  maximum_interval_days: 36_500,
  learning_steps_min: [1, 10] as number[],
  graduating_interval_days: 1,
  easy_interval_days: 4,
  relearning_steps_min: [10] as number[],
  leech_threshold: 8,
  lapse_interval_factor: 0.0,
  minimum_interval_days: 1,
  starting_ease_milli: 2500,
  easy_bonus: 1.3,
  hard_interval_factor: 1.2,
  interval_modifier: 1.0,
  fsrs_weights: [...FSRS6_DEFAULT_WEIGHTS],
};
