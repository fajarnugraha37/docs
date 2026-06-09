package example;

import org.springframework.stereotype.Repository;

@Repository
public class CandidateRepository {
    public Candidate findById(String id) {
        return new Candidate();
    }

    public Candidate save(Candidate candidate) {
        return candidate;
    }
}
