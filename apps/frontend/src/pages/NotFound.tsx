import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState } from "../components/EmptyState";

export function NotFound(): JSX.Element {
  return (
    <div className="page max-w-2xl">
      <EmptyState
        icon={Compass}
        title="Page not found"
        action={
          <Link to="/" className="btn-primary">
            Back to dashboard
          </Link>
        }
      >
        That address doesn&apos;t lead anywhere in BrewHub.
      </EmptyState>
    </div>
  );
}
