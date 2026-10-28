<!-- upstash-box-visual-review -->
## Visual Review: PASS

PR #1. **FAIL on `main`, PASS on `PR #1`.** Checked in local Chromium 156.0.8078.4 at 390x844 and 1440x900.

| Before: `main` | After: `PR #1` |
| --- | --- |
| <img src="https://raw.githubusercontent.com/leoisadev1/box-pr-visual-tester/main/artifacts/pr-1/before-mobile.png" width="300" alt="Before, mobile"> | <img src="https://raw.githubusercontent.com/leoisadev1/box-pr-visual-tester/main/artifacts/pr-1/after-mobile.png" width="300" alt="After, mobile"> |

### Rule-based verdict

**Fixes the checkout button on 390x844**

On main, "Confirm upgrade" ends 66px below the fold (0% visible) and cannot be clicked, with 0 console errors. On PR #1, "Confirm upgrade" is 100% visible and submitting with an empty name shows "Enter the name on your card.", with 0 console errors.

### DOM metrics, mobile 390x844

| Check | `main` | `PR #1` |
| --- | --- | --- |
| "Confirm upgrade" bottom edge | 910px | 745.4px |
| Below the fold | 66px | 0px |
| Button visible | 0% | 100% |
| Submit with empty name | Button unreachable | Shows "Enter the name on your card." |
| Console errors | 0 | 0 |
| Desktop 1440x900 | PASS | PASS |

<details><summary>Desktop screenshots</summary>

| Before | After |
| --- | --- |
| <img src="https://raw.githubusercontent.com/leoisadev1/box-pr-visual-tester/main/artifacts/pr-1/before-desktop.png" width="420" alt="Before, desktop"> | <img src="https://raw.githubusercontent.com/leoisadev1/box-pr-visual-tester/main/artifacts/pr-1/after-desktop.png" width="420" alt="After, desktop"> |

</details>
