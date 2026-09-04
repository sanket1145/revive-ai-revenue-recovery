GRANT EXECUTE ON FUNCTION public.revive_audit(text,text,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.revive_eligible_txns(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revive_recovery_score(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revive_propose_recovery(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revive_decide_recovery(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revive_execute_recovery(text,text) TO service_role;