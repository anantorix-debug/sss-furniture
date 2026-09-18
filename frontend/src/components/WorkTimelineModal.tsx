import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { useAuth } from '@/context/AuthContext';
import { Modal } from './Modal';
import { WorkItemTimelineCard } from './WorkItemTimelineCard';
import type { CarpenterWorkItem } from '@/types';

// One item's work-item history - its own fetch (there's no order-level
// filter for party-order-sourced work items, only sourcePartyOrderItemId),
// mirroring the same per-item pattern PartyLineProduction already uses.
function ItemTimeline({ itemId, productName }: { itemId: string; productName: string }) {
  const { hasRole } = useAuth();
  const { data: workItems, isLoading, mutate } = useSWR<CarpenterWorkItem[]>(`/carpenter-work-items?sourcePartyOrderItemId=${itemId}`, fetcher);

  return (
    <div className="border-t border-brand-100 pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-brand-900 mb-2">{productName}</h3>
      {isLoading && <p className="text-sm text-brand-400">Loading...</p>}
      {!isLoading && (workItems?.length ?? 0) === 0 && <p className="text-sm text-brand-400">No production started yet for this item.</p>}
      <div className="space-y-2">
        {workItems?.map((w) => (
          <WorkItemTimelineCard key={w.id} workItem={w} canEditDates={hasRole('ADMIN')} onUpdated={() => mutate()} />
        ))}
      </div>
    </div>
  );
}

export function WorkTimelineModal({
  orderLabel,
  items,
  onClose,
}: {
  orderLabel: string;
  items: { id: string; productName: string }[];
  onClose: () => void;
}) {
  return (
    <Modal title={`${orderLabel} - Work Timeline`} onClose={onClose} wide>
      <div className="space-y-4">
        {items.length === 0 ? (
          <p className="text-sm text-brand-400">This order has no items to show a work timeline for.</p>
        ) : (
          items.map((item) => <ItemTimeline key={item.id} itemId={item.id} productName={item.productName} />)
        )}
        <div className="flex justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
