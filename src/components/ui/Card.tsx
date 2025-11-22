import React from "react";

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", children, ...rest }) => (
  <div className={`card ${className}`} {...rest}>{children}</div>
);

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", children, ...rest }) => (
  <div className={`card-body ${className}`} {...rest}>{children}</div>
);
