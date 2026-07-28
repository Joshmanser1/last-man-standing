import { Navigate, useLocation } from "react-router-dom";

export function Results() {
  const location = useLocation();
  const next = location.search ? `/leaderboard${location.search}` : "/leaderboard";
  return <Navigate to={next} replace />;
}
