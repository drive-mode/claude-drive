---
name: autoresearch-optimize
description: Run an AutoResearch-style prompt optimization loop. Mutates a prompt iteratively using hill-climbing, evaluates against test scenarios, and keeps improvements.
tags: [autoresearch, optimization, prompt-engineering]
requiredRole: researcher
requiredPreset: standard
parameters:
  - name: prompt
    description: The prompt text to optimize
    required: true
  - name: iterations
    description: Number of optimization iterations
    required: false
    default: "20"
  - name: tag
    description: Eval scenario tag to filter by
    required: false
---

# AutoResearch Prompt Optimization

You are running an autonomous prompt optimization loop inspired by Karpathy's AutoResearch framework.

## Your Task

Optimize the following prompt through iterative mutation and evaluation:

```
{{prompt}}
```

## Process

1. **Baseline**: First, run `evaluation_run` with the current prompt to establish a baseline score.

2. **Optimize**: Start the optimization loop:
   - Use `optimizer_start` with the prompt and {{iterations}} iterations
   - Monitor progress with `optimizer_status`

3. **Analyze**: When complete:
   - Use `optimizer_status` to review the full history
   - Identify which mutation operators were effective
   - Use `optimizer_apply` to retrieve the best prompt

4. **Report**: Summarize findings:
   - Baseline vs final score
   - Which mutations moved the needle
   - The optimized prompt text

## Key Principles (from AutoResearch)

- **Small changes**: Each iteration should make one focused change
- **Measure everything**: Score before and after every mutation
- **Keep or revert**: Only keep changes that measurably improve the score
- **Hill-climbing**: Greedily optimize — compound small wins

Report your findings via `agent_screen_decision` and `tts_speak`.
