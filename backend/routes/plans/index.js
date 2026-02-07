const express = require('express');
const crudRoutes = require('./crud');
const workoutRoutes = require('./workouts');
const mealRoutes = require('./meals');
const assignmentRoutes = require('./assignments');
const progressRoutes = require('./progress');
const dashboardRoutes = require('./dashboard');

const router = express.Router({ mergeParams: true });

// Plan CRUD + my-plan (/, /my-plan, /:planId)
router.use('/', crudRoutes);

// Workout items (/:planId/workouts)
router.use('/', workoutRoutes);

// Meal items (/:planId/meals)
router.use('/', mealRoutes);

// Assignments (/:planId/assign, /:planId/assignments)
router.use('/', assignmentRoutes);

// Progress tracking (/:planId/progress/*)
router.use('/', progressRoutes);

// Trainer dashboard (/:planId/dashboard)
router.use('/', dashboardRoutes);

module.exports = router;
