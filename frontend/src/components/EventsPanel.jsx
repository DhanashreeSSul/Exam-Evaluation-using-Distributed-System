import { Activity, Vote } from "lucide-react";

// FA1 covers Unit 1 & 2 only. The Lamport Clock column (Unit 3) and the
// Election Logs section (Unit 3, Bully algorithm) are hidden for now.
// Flip to true to show them again for FA2 - no backend change needed,
// the coordinator keeps logging both the whole time.
const SHOW_UNIT_3_4 = true;

export default function EventsPanel({ events, electionLogs }) {
  return (
    <div className="panel">
      <h2>
        <Activity /> Distributed Events
      </h2>
      <div className="event-log">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Process</th>
              {SHOW_UNIT_3_4 && <th>Lamport Clock</th>}
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={SHOW_UNIT_3_4 ? 4 : 3} className="muted">
                  No events yet.
                </td>
              </tr>
            )}
            {events.map((e, i) => (
              <tr key={i}>
                <td>{e.event}</td>
                <td>{e.process}</td>
                {SHOW_UNIT_3_4 && <td>{e.lamport_clock}</td>}
                <td>{e.timestamp ? new Date(e.timestamp + "Z").toLocaleTimeString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {SHOW_UNIT_3_4 && electionLogs && electionLogs.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>
            <Vote /> Election Logs
          </h2>
          <div className="event-log">
            <table>
              <thead>
                <tr>
                  <th>Message</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {electionLogs.map((l, i) => (
                  <tr key={i}>
                    <td>{l.message}</td>
                    <td>{new Date(l.timestamp + "Z").toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}