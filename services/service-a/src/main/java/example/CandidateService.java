package example;

import org.springframework.stereotype.Service;

@Service
public class CandidateService {
    private final CandidateRepository candidateRepository;

    public CandidateService(CandidateRepository candidateRepository) {
        this.candidateRepository = candidateRepository;
    }

    public Candidate submit(String candidateId) {
        Candidate candidate = candidateRepository.findById(candidateId);
        if (candidate.getStatus() != CandidateStatus.DRAFT) {
            throw new IllegalStateException("candidate must be DRAFT before submission");
        }
        candidate.setStatus(CandidateStatus.SUBMITTED);
        return candidateRepository.save(candidate);
    }
}
