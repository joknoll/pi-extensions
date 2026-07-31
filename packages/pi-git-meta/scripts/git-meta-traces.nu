def main [] {
  # ponytail: one metadata read per commit; use a bulk git-meta query if histories get large
  let ids = (
    ^git rev-list --all
    | lines
    | each {|sha| ^git-meta get $"commit:($sha)" agent:traces | lines }
    | flatten
    | append (^git-meta get project meta:local:pi:pending-traces | lines)
    | where {|id| $id =~ '^(pi-trace-)?[0-9a-f-]{36}$' }
    | uniq
  )
  let traces = (
    $ids
    | each {|id|
        try {
          let trace = (
            ^git-meta get $"change-id:($id)" pi:trace-chunk --json
            | from json
            | get pi.trace-chunk
            | transpose index chunk
            | sort-by index
            | get chunk
            | str join
            | decode base64
            | decode utf-8
            | from json
          )
          {
            started: ($trace.run.startedAt | into datetime | format date '%Y-%m-%d %H:%M')
            branch: ($trace.git.branch? | default detached)
            commits: ($trace.git.detectedCommits | length)
            prompt: $trace.run.prompt
            trace: $trace
          }
        }
      }
    | compact
  )
  if ($traces | is-empty) { return }

  let selected = (
    $traces | select started branch commits prompt | input list --index "Select a Pi trace"
  )
  if $selected != null {
    $traces | get $selected | get trace | table --expand --expand-deep 3
  }
}
