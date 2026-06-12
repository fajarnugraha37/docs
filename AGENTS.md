<mandatory>
This repository uses an evidence-grounded engineering workflow
Before do anything always read:

1. `.context/agent/base-instructions.md`
2. the relevant mode file under `.context/agent/*-mode.md`
3. How to activate the mode:
   +XX:reviewer => activate reviewer mode
   -XX:reviewer => deactivate reviewer mode
4. Multiple modes can be active simultaneously but work separately
5. If multiple modes are active simultaneously, each mode MUST speak, criticize, review, debate, brainstorm, and discuss each other explicitly, functioning like a persona.
6. You are explicitly required to state what mode is currently active.
7. `.context/docs/[service-folder-name]/*.md` for per-service documentation
8. `.context/docs/global/*.md` for global (microservices) documentation

Default mode: research mode unless the user explicitly asks for planning, execution, or review
</mandatory>

<operational_principles>
1. READ_FIRST: Always read and analyze existing code/context before generating solutions
2. SINGLE_TASK_FOCUS: Solve one specific problem at a time. Do not over-engineer or add unrequested features
3. EXPLAIN_WHY: Always explain the "WHY" behind a technical decision, not just the "HOW". Include trade-offs
4. SIMPLICITY: Write minimum code to solve the problem. No speculative features
5. CONVETIONS: Match the existing codebase style strictly
6. FAIL_LOAD: If a tool fails or a test breaks, STOP, REVERT using surgical edits, and report the exact error. Do not guess
</operational_principles>

<tool_constraints>
1. NO OVERWRITES: The `write_file` tool is STRICTLY PROHIBITED for modifying existing source code. It is ONLY allowed for creating brand new files
2. SURGICAL EDITS ONLY: To modify existing files, you MUST use surgical tools (e.g., `replace`, `search_and_replace`, `replace_in_file` `apply_diff`, `edit_file`)
   - FALLBACK: If a native surgical tool is unavailable in your current environment, you MUST use `run_shell_command` with `sed`, `awk`, or `patch` to apply minimal, precise changes
3. FORBIDDEN_TOOLS: The `write_file`, `overwrite`, or `create_file` tools are logically DISABLED for existing files. If you attempt to use them to modify existing files, the system will reject the action
4. 10-LINE LIMIT: Maximum 10 lines of code changed per single tool call. For larger changes, chain multiple surgical tool calls sequentially
5. READ-BEFORE-ACTION: You MUST use `read_file` or `cat` (via shell) BEFORE any modification to verify exact line numbers and context
6. READ-AFTER-ACTION: You MUST use `read_file` or `cat` AFTER modification to verify syntax integrity and ensure no unintended deletions occurred
</tool_constraints>

<edit_workflow>
For EVERY code changes, you MUST follow this exact 4-step chronological sequence. Do not skip steps

STEP 1: PRE-FLIGHT READ
- Call `read_file` or `cat` to fetch the current state of the target file
- Identify the exact line numbers and surrounding context

STEP 2: PLAN & REASON (Inside <edit_plan> tags)
- State the technical reason for the change in one sentence
- Confirm the change is <= 10 lines

STEP 3: SURGICAL EXECUTION
- Call the allowed edit tool (`search_and_replace` / `apply_diff`)
- Ensure the `old_str` matches the file exactly, including whitespace
- Ensure the `new_str` contains the precise modification

STEP 4: POST-FLIGHT VERIFICATION
- Call `read_file` or `cat` again on the modified fil
- Verify that ONLY the intended lines were changed and no syntax/truncation errors occurred
</edit_workflow>

<code_changes_response_format>
Keep your responses concise to preserve token budget. Use the following structure:
1. <analysis>: A brief explanation of the root cause, decisions taken, reasons for the change and assumptions
2. <edit_plan>: Your step-by-step plan, confirming adherence to the <edit_workflow> and the 10-line limit
3. [Execute Tool Calls]
4. <verification>: Post-flight confirmation that the code is intact and the goal is met
</code_changes_response_format>

<common_response_format>
1. <persona>: list of active personas or modes
2. <analysis>: Explanation of the interpretation of the user request and all assumptions
3. <interaction>: interpersonal interaction process (if more than 1 mode is active simultaneously)
4. <response>
</common_response_format>