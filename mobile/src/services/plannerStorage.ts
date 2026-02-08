import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  MealType,
  PlannerDay,
  PlannerDayKey,
  PlannerMeal,
  PlannerWorkout,
  WeeklyPlanner,
} from '../types/planner';

const STORAGE_KEY = '@weekly_planner_v1';

const ALL_DAYS: PlannerDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function createId(prefix: 'w' | 'm'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyDay(day: PlannerDayKey): PlannerDay {
  return {
    day,
    workouts: [],
    meals: [],
    notes: '',
  };
}

export function createEmptyPlanner(): WeeklyPlanner {
  const days = ALL_DAYS.reduce<Record<PlannerDayKey, PlannerDay>>((acc, day) => {
    acc[day] = createEmptyDay(day);
    return acc;
  }, {} as Record<PlannerDayKey, PlannerDay>);

  return {
    updatedAt: new Date().toISOString(),
    days,
  };
}

function normalizePlanner(raw: Partial<WeeklyPlanner> | null | undefined): WeeklyPlanner {
  const fallback = createEmptyPlanner();
  if (!raw || !raw.days) return fallback;

  const days = ALL_DAYS.reduce<Record<PlannerDayKey, PlannerDay>>((acc, day) => {
    const existing = raw.days?.[day];
    acc[day] = {
      day,
      workouts: Array.isArray(existing?.workouts) ? existing.workouts : [],
      meals: Array.isArray(existing?.meals) ? existing.meals : [],
      notes: typeof existing?.notes === 'string' ? existing.notes : '',
    };
    return acc;
  }, {} as Record<PlannerDayKey, PlannerDay>);

  return {
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : fallback.updatedAt,
    days,
  };
}

export async function loadPlanner(): Promise<WeeklyPlanner> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return createEmptyPlanner();
    }
    const parsed = JSON.parse(stored) as Partial<WeeklyPlanner>;
    return normalizePlanner(parsed);
  } catch (error) {
    console.warn('[PlannerStorage] load failed:', error);
    return createEmptyPlanner();
  }
}

export async function savePlanner(planner: WeeklyPlanner): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(planner));
}

function touch(planner: WeeklyPlanner): WeeklyPlanner {
  return {
    ...planner,
    updatedAt: new Date().toISOString(),
  };
}

export function addWorkout(planner: WeeklyPlanner, day: PlannerDayKey, title: string): WeeklyPlanner {
  const trimmed = title.trim();
  if (!trimmed) return planner;

  const next: PlannerWorkout = {
    id: createId('w'),
    title: trimmed,
    completed: false,
    createdAt: new Date().toISOString(),
  };

  return touch({
    ...planner,
    days: {
      ...planner.days,
      [day]: {
        ...planner.days[day],
        workouts: [next, ...planner.days[day].workouts],
      },
    },
  });
}

export function toggleWorkout(planner: WeeklyPlanner, day: PlannerDayKey, workoutId: string): WeeklyPlanner {
  return touch({
    ...planner,
    days: {
      ...planner.days,
      [day]: {
        ...planner.days[day],
        workouts: planner.days[day].workouts.map((workout) =>
          workout.id === workoutId
            ? {
                ...workout,
                completed: !workout.completed,
              }
            : workout,
        ),
      },
    },
  });
}

export function removeWorkout(planner: WeeklyPlanner, day: PlannerDayKey, workoutId: string): WeeklyPlanner {
  return touch({
    ...planner,
    days: {
      ...planner.days,
      [day]: {
        ...planner.days[day],
        workouts: planner.days[day].workouts.filter((workout) => workout.id !== workoutId),
      },
    },
  });
}

export function addMeal(
  planner: WeeklyPlanner,
  day: PlannerDayKey,
  type: MealType,
  customTitle?: string,
): WeeklyPlanner {
  const normalizedType = type.trim() as MealType;
  const defaultTitle = normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1);

  const next: PlannerMeal = {
    id: createId('m'),
    type: normalizedType,
    title: customTitle && customTitle.trim() ? customTitle.trim() : defaultTitle,
    createdAt: new Date().toISOString(),
  };

  return touch({
    ...planner,
    days: {
      ...planner.days,
      [day]: {
        ...planner.days[day],
        meals: [next, ...planner.days[day].meals],
      },
    },
  });
}

export function removeMeal(planner: WeeklyPlanner, day: PlannerDayKey, mealId: string): WeeklyPlanner {
  return touch({
    ...planner,
    days: {
      ...planner.days,
      [day]: {
        ...planner.days[day],
        meals: planner.days[day].meals.filter((meal) => meal.id !== mealId),
      },
    },
  });
}

export function updateDayNotes(planner: WeeklyPlanner, day: PlannerDayKey, notes: string): WeeklyPlanner {
  return touch({
    ...planner,
    days: {
      ...planner.days,
      [day]: {
        ...planner.days[day],
        notes,
      },
    },
  });
}
