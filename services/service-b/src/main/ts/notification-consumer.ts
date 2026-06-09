export type CandidateSubmittedEvent = {
  candidateId: string;
  submittedAt: string;
};

export async function handleCandidateSubmitted(event: CandidateSubmittedEvent): Promise<void> {
  if (!event.candidateId) {
    throw new Error("candidateId is required");
  }

  await sendEmail(event.candidateId, "candidate-submitted");
}

async function sendEmail(candidateId: string, template: string): Promise<void> {
  console.log(`sending ${template} email for ${candidateId}`);
}
