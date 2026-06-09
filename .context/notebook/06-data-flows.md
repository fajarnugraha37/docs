# Data Flows

| claim | evidence | confidence |
|---|---|---|
| Persistence entity annotation detected: @Entity | `services/service-a/src/main/java/example/Candidate.java:6-6` | high |
| Repository pattern detected: @Repository | `services/service-a/src/main/java/example/CandidateRepository.java:5-5` | medium |
| SQL table definition/change detected: CREATE TABLE candidate ( | `services/service-a/src/main/resources/db/migration/V1__candidate.sql:1-1` | high |
