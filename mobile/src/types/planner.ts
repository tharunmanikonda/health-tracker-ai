export type PlannerDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface PlannerWorkout {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

export interface PlannerMeal {
  id: string;
  type: MealType;
  title: string;
  createdAt: string;
}

export interface PlannerDay {
  day: PlannerDayKey;
  workouts: PlannerWorkout[];
  meals: PlannerMeal[];
  notes: string;
}

export interface WeeklyPlanner {
  updatedAt: string;
  days: Record<PlannerDayKey, PlannerDay>;
}
