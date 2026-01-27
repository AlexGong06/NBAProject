import "./App.css";
import DailyMvpRankings from "./components/DailyMvpRankings";

function App() {
  return (
    <>
      <div>
        <h1>NBA MVP Tracker</h1>
        <DailyMvpRankings />
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  );
}

export default App;
