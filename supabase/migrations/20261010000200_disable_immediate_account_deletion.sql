-- Older mobile builds called this function directly. Keep the database object
-- for migration compatibility, but remove all client execution privileges so
-- account deletion can only enter through request_my_account_deletion().
revoke execute on function public.delete_my_account() from public;
revoke execute on function public.delete_my_account() from anon;
revoke execute on function public.delete_my_account() from authenticated;
