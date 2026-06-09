# State Machines

| claim | evidence | confidence |
|---|---|---|
| Possible status/state transition reference detected: this.status = status; | `services/service-a/src/main/java/example/Candidate.java:17-17` | medium |
| Possible status/state transition reference detected: if (candidate.getStatus() != CandidateStatus.DRAFT) { | `services/service-a/src/main/java/example/CandidateService.java:15-15` | medium |
| Possible status/state transition reference detected: candidate.setStatus(CandidateStatus.SUBMITTED); | `services/service-a/src/main/java/example/CandidateService.java:18-18` | medium |
