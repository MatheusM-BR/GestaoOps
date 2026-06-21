// Notificação push da plataforma RemateWeb. O corpo de envio espelha o schema
// NotificationCreateVm da API (POST /api/notification). Ver docs/remateweb-api.md.
//
// Estratégia atual: capturamos os dados e gravamos um rascunho/registro no
// Firestore; o POST real na API RemateWeb é fase futura.

// Payload exato aceito por POST /api/notification.
export interface NotificationCreateVm {
  breeds: number[];        // IDs de Raça (segmentação); vazio = todas
  sendToOthers: boolean;   // "Enviar para anônimos"
  title: string;
  message: string;
  auctionId: number | null; // se informado → categoria AuctionReminder
}

export type NotificationStatus = 'rascunho' | 'enviada' | 'erro';

// Registro persistido no Firestore (rascunho + metadados de envio).
export interface NotificationRecord {
  id?: string;
  title: string;
  message: string;
  breeds: number[];
  breedNames: string[];     // denormalizado para exibição
  sendToOthers: boolean;
  auctionId: number | null;
  auctionTitle: string;
  eventId: string | null;   // id do GestaoEvent vinculado, quando houver
  status: NotificationStatus;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Monta o payload da API a partir de um registro.
export function toNotificationPayload(rec: NotificationRecord): NotificationCreateVm {
  return {
    breeds: rec.breeds,
    sendToOthers: rec.sendToOthers,
    title: rec.title,
    message: rec.message,
    auctionId: rec.auctionId,
  };
}
