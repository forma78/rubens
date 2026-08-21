import { Chrome } from "@/components/chrome";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Chrome active="login" crumb="rubens-pearl / login">
      <div className="page-head">
        <h1 className="page-title">Sign in</h1>
      </div>
      <LoginForm />
    </Chrome>
  );
}
