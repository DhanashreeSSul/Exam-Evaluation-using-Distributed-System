import { Activity, Vote } from "lucide-react";

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
              <th>Lamport Clock</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan="4" className="muted">
                  No events yet.
                </td>
              </tr>
            )}
            {events.map((e, i) => (
              <tr key={i}>
                <td>{e.event}</td>
                <td>{e.process}</td>
                <td>{e.lamport_clock}</td>
                <td>{e.timestamp ? new Date(e.timestamp + "Z").toLocaleTimeString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {electionLogs && electionLogs.length > 0 && (
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
