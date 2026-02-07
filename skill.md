# HealthSync - Reference Repos Skill Guide

Quick-reference for two cloned repos that may help solve specific problems in HealthSync.

---

## Repo 1: adenhq/hive

**Location:** `/Users/tharun/Desktop/tharun-p/hive`
**Source:** https://github.com/adenhq/hive
**What it is:** Y Combinator-backed AI agent framework (Python). NOT a health tracker.
**Language:** Python 3.11+, Pydantic v2, LiteLLM, FastMCP

### When to reference this repo:

**OAuth2 / Token Management Issues**
- Clean extensible OAuth2 base class at `core/framework/credentials/oauth2/base_provider.py`
- Token lifecycle manager with auto-refresh at `core/framework/credentials/oauth2/lifecycle.py`
- OAuth2Config model at `core/framework/credentials/oauth2/provider.py`
- Use when: Adding new health device OAuth flows (Garmin, Oura, etc.), fixing token refresh bugs, standardizing multi-provider auth

**Credential Storage / Security**
- Encrypted file storage at `core/framework/credentials/storage.py`
- Key-vault structure (credentials as objects with multiple keys) at `core/framework/credentials/models.py`
- SecretStr usage to prevent accidental token logging
- Use when: Improving how we store WHOOP/Fitbit tokens, adding encryption, preventing credential leaks in logs

**Event-Driven Architecture**
- Full pub/sub event bus at `core/framework/runtime/event_bus.py`
- Event types: lifecycle, state changes, streaming
- Subscription with filters by event type
- Use when: Implementing webhook handlers, real-time health data events, notification system for new recovery/sleep scores

**Multi-Provider Adapter Pattern**
- Tool registry pattern at `core/framework/runner/tool_registry.py`
- Each integration is a self-contained module with standard interface
- Use when: Refactoring wearables.js to support more devices cleanly, creating a provider abstraction layer

**Relevant file index:**
```
core/framework/credentials/oauth2/base_provider.py   - OAuth2 base class
core/framework/credentials/oauth2/lifecycle.py        - Token auto-refresh
core/framework/credentials/oauth2/provider.py         - OAuth2Token, OAuth2Config models
core/framework/credentials/store.py                   - Credential store (22KB)
core/framework/credentials/storage.py                 - Encrypted/Env/InMemory backends
core/framework/credentials/models.py                  - CredentialObject, SecretStr usage
core/framework/runtime/event_bus.py                   - Async pub/sub event system
core/framework/runtime/shared_state.py                - Shared state between components
core/framework/llm/litellm.py                         - Multi-provider LLM abstraction
```

---

## Repo 2: NLL369/FitBit-Fitness-Tracker-Data-Project

**Location:** `/Users/tharun/Desktop/tharun-p/fitbit-fitness-tracker`
**Source:** https://github.com/NLL369/FitBit-Fitness-Tracker-Data-Project
**What it is:** Google Data Analytics capstone - Jupyter notebook analyzing static FitBit CSV data (2016, 33 users, 940 records)
**Language:** Python, Pandas, Matplotlib, Seaborn

### When to reference this repo:

**FitBit Data Field Mapping**
- CSV schema maps all 15 FitBit daily activity fields
- Fields: TotalSteps, TotalDistance, TrackerDistance, VeryActiveDistance, ModeratelyActiveDistance, LightActiveDistance, SedentaryActiveDistance, VeryActiveMinutes, FairlyActiveMinutes, LightlyActiveMinutes, SedentaryMinutes, Calories
- Use when: Normalizing FitBit API responses, building the wearables sync, mapping API fields to our database columns

**Activity Intensity Breakdown**
- Categorizes activity into 4 levels: Very Active (1.7%), Fairly Active (1.1%), Lightly Active (15.9%), Sedentary (81.3%)
- Use when: Building activity breakdown charts on dashboard, creating activity level badges/insights

**Health Benchmarks & Thresholds**
- CDC daily step target: 10,000
- WHO weekly active minutes: 150 (or 75 vigorous)
- Sedentary alert threshold: 1,200+ minutes/day
- Average steps: 7,637/day, average calories: 2,303/day
- Use when: Setting default goals, generating insights like "You're X steps below the CDC target"

**Steps-to-Calories Correlation**
- Strong positive correlation up to ~15,000 steps
- Plateau/diminishing returns above 15,000 steps
- Approx ratio: 0.3 cal/step (at average activity level)
- Use when: Estimating calories when device doesn't report them, validating data quality

**Anomaly Detection Patterns**
- Zero steps + zero calories = missed tracking day
- High steps (35k+) + low calories (<3k) = data error
- Sedentary minutes = 1,440 (full day) = device not worn
- Use when: Building data quality checks for synced FitBit/WHOOP data, flagging bad data before showing to user

**Weekly Usage Patterns**
- Peak engagement: Tuesday through Friday
- Lower engagement: Weekends and Monday
- Use when: Building "Your most active days" insights, scheduling notification timing

**Insight Generation Logic**
- Steps below target: suggest 15-min walk (~2,000 steps)
- Low active minutes (<30/day): suggest adding workout
- High sedentary time: suggest hourly movement breaks
- Use when: Building the AI Coach recommendations, creating automated daily/weekly insights

**Relevant file index:**
```
Google Data Analytics Capstone - Bellabeat Project.ipynb  - Full analysis notebook
dailyActivity_merged.csv                                  - Raw FitBit data (940 rows x 15 cols)
README.md                                                 - Business context and methodology
```

---

## Quick Decision Guide

| Problem | Which Repo | What to Look At |
|---------|-----------|-----------------|
| OAuth token refresh failing | hive | `credentials/oauth2/lifecycle.py` |
| Adding new device (Garmin/Oura) | hive | `credentials/oauth2/base_provider.py` |
| Token storage security | hive | `credentials/storage.py`, `models.py` |
| Webhook/event system design | hive | `runtime/event_bus.py` |
| FitBit field name mapping | fitbit-tracker | `dailyActivity_merged.csv` header + notebook cell renaming columns |
| Activity level breakdown | fitbit-tracker | Notebook pie chart section |
| Health goal defaults | fitbit-tracker | CDC/WHO benchmarks in README + notebook |
| Data anomaly detection | fitbit-tracker | Notebook outlier analysis section |
| Calorie estimation | fitbit-tracker | Notebook scatter plot (steps vs calories) |
| User insight text | fitbit-tracker | Notebook findings + recommendations |
| Multi-provider data normalization | both | hive for architecture pattern, fitbit-tracker for field mappings |
