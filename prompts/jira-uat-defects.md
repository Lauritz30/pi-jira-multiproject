---
description: List all open UAT defects, ordered by priority and age
---
Use jira_search_issues with this JQL (the saved filter "UAT: All Open Defects"):

`project = UAT AND issuetype = Defect AND statusCategory != Done ORDER BY priority DESC, created ASC`

Summarize the results grouped by priority, and call out any issue older than 5 days.
