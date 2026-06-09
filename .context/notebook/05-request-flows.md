# Request Flows

| claim | evidence | confidence |
|---|---|---|
| Spring mapping annotation detected: @RequestMapping("/candidates") | `services/service-a/src/main/java/example/CandidateController.java:8-8` | high |
| Spring mapping annotation detected: @PostMapping("/{candidateId}/submit") | `services/service-a/src/main/java/example/CandidateController.java:16-16` | high |
| Spring service annotation detected: @Service | `services/service-a/src/main/java/example/CandidateService.java:5-5` | high |
