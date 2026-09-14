import { Request, Response, NextFunction } from "express";

/** Restrict production Admin API to explicitly configured source IPs/CIDRs. */
export function requireAuthorizedAdminNetwork(req: Request, res: Response, next: NextFunction) {
  if (String(process.env.RIDEX_ENVIRONMENT || process.env.NODE_ENV || "TEST").toUpperCase() !== "PRODUCTION") return next();
  const configured = String(process.env.RIDEX_ADMIN_ALLOWED_IPS || "").split(",").map(x=>x.trim()).filter(Boolean);
  if (!configured.length) return res.status(503).json({success:false,message:"Production Admin network allowlist is not configured"});
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = (forwarded || req.ip || "").replace(/^::ffff:/,"");
  const allowed = configured.some(rule => rule === ip || (rule.endsWith("/24") && ip.split(".").slice(0,3).join(".") === rule.replace("/24","") || rule.endsWith("/16") && ip.split(".").slice(0,2).join(".") === rule.replace("/16","")));
  if (!allowed) return res.status(403).json({success:false,message:"Admin access is restricted to the authorized production laptop/network"});
  return next();
}
