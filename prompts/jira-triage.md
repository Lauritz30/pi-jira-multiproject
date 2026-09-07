---
description: Triage Sev1/Sev2 defects aging more than 2 days
argument-hint: "[project]"
---
Use jira_search_issues with this JQL (the saved filter "UAT: Sev1/Sev2 Aging > 2d"), substituting the project if given:

`project = ${1:-UAT} AND issuetype = Defect AND priority in (Highest, High) AND statusCategory != Done AND created <= -2d ORDER BY created ASC`

For each result, fetch jira_get_issue_transitions to show what triage actions are available, and propose next steps per issue.
