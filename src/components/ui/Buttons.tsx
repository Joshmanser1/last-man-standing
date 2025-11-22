import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  asChild?: boolean;
};

export const Button: React.FC<Props> = ({ variant = "primary", className = "", ...props }) => {
  const v = variant === "ghost" ? "btn-ghost" : variant === "danger" ? "btn-danger" : "btn-primary";
  return <button className={`${v} ${className}`} {...props} />;
};
