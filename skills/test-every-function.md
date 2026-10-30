---
name: test-every-function
description: Use when writing or reviewing code with AI and you want it verified rather than just running. Makes the AI define success and rigorously test every function and its edge cases.
---

# Test every function

## What this skill does
It flips the AI from "make it run" to "prove it is right." When it is on, the AI does not consider a function done until it has said what success means, written tests that cover the ordinary case and the edges, and shown you the tests so you can judge them. You stay the manager who owns "done."

## The rule you are enforcing
Karpathy's line: today's AI automates what you can **verify**. So the skill is not writing tests by hand, it is telling the AI what counts as success and demanding every function be tested against it. The bar for every function: **would you bet a million dollars this is right?** If not, it is not tested enough.

## How to respond when this skill is active
1. **Specify success first.** Before testing a function, state in one plain sentence what it must do and how you will know it worked. If the spec is vague, ask the user to sharpen it. A vague ask gets a confident wrong answer.
2. **Test every function on its own.** Break the work into small functions and check each one. Checking that the whole program runs is not the same as checking each piece is correct.
3. **Hit the edges as well as the happy path.** For each function, enumerate: the ordinary case, the empty/zero/one case, the boundary case, and the case the spec is silent on. Write a test for each.
4. **Name the silent-failure trap.** A function that returns a hardcoded answer for the one input you tested will pass that test and still be wrong. So test more than one input, and test inputs whose answer you can compute independently.
5. **Show the tests and the reasoning.** Print the tests and say what each one is checking, so the human can confirm the coverage. Do not hide verification inside "looks good."
6. **Verify without a human where you can.** Prefer checks the code can run itself (assert expected == actual) over "eyeball the output." If a check truly needs human judgment, say so and keep the human in the loop for that one.
7. **Report honestly.** End with: which functions are covered, which edges are tested, and where you would NOT yet bet $1M. Do not declare done past that line.

## Good practice
- Plan top-down, test bottom-up: design the whole thing first, then verify the small pieces that make it up.
- One behavior per test, with a name that says what it checks.
- When a test fails, fix the code or the spec, then re-run; never delete a failing test to make it green.
- Testing is a craft. The goal is coverage of the ways this specific function can go wrong, rather than a fixed number of tests.

## Pitfalls
- Tests that only re-run the happy path give false confidence.
- Asserting on output you never independently computed just checks the code agrees with itself.
- "It compiles and runs" is the black-box gambler's standard. The manager's standard is "I can show you why it is right."
