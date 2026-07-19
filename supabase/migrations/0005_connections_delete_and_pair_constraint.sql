-- Phase 3 prep: connections needs to support cancelling a pending request
-- (requester) and removing an existing connection (either party). Neither is
-- currently possible -- connections has RLS enabled with zero DELETE
-- policies, which denies everyone, including the two actual parties.
-- Confirmed by the RLS suite's existing "(uninvolved) cannot delete" test,
-- which passes for that reason today.
--
-- One symmetric policy covers both cases: cancelling a pending request is
-- just a delete by the requester, removing an existing connection is just a
-- delete by either party -- no need to branch on status.
create policy "connections_delete_own" on connections
  for delete to authenticated
  using (requester_id = auth.uid() or recipient_id = auth.uid());

-- unique(requester_id, recipient_id) only blocks exact-direction duplicates
-- -- it doesn't stop B inserting a mirrored B->A row while A->B is already
-- pending, which would produce two separate rows instead of one mutual
-- connection. Replace it with a direction-agnostic constraint so there can
-- only ever be one connection row between any two people, regardless of who
-- requested. (Phase 3's insert flow will need to handle the resulting unique
-- violation -- e.g. surfacing "there's already a pending request between you
-- two" -- instead of assuming a fresh insert always succeeds.)
alter table connections drop constraint connections_requester_id_recipient_id_key;

create unique index connections_unique_pair
  on connections (least(requester_id, recipient_id), greatest(requester_id, recipient_id));
