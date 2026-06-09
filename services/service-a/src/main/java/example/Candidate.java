package example;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class Candidate {
    @Id
    private String id;
    private CandidateStatus status;

    public CandidateStatus getStatus() {
        return status;
    }

    public void setStatus(CandidateStatus status) {
        this.status = status;
    }
}
