'use client';
import { FileText, ImageIcon, Video, ExternalLink, Phone, CornerUpLeft } from 'lucide-react';
import type { TemplatePreview as Preview } from '@/modules/whatsapp/template-types';
import { templateLanguageLabel, templateCategoryLabels } from '@/modules/whatsapp/template-types';
import { MessageAttachment } from './message-attachment';
import type { ChatMessage } from '@/modules/whatsapp/types';

function formattedText(text: string) {
  return text.split(/(```[\s\S]*?```|\*[^\n*]+\*|_[^\n_]+_|~[^\n~]+~)/g).map((part, index) => {
    if (part.startsWith('```') && part.endsWith('```'))
      return <code key={index}>{part.slice(3, -3)}</code>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <strong key={index}>{part.slice(1, -1)}</strong>;
    if (part.startsWith('_') && part.endsWith('_')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('~') && part.endsWith('~')) return <s key={index}>{part.slice(1, -1)}</s>;
    return part;
  });
}

export function TemplatePreview({
  preview,
  tenantId,
  message,
  file,
  fileUrl,
}: {
  preview: Preview;
  tenantId?: string;
  message?: ChatMessage;
  file?: File | null;
  fileUrl?: string | null;
}) {
  const media = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(preview.header.format);
  return (
    <div className="template-preview">
      <span className="template-message-label">
        Plantilla · {templateCategoryLabels[preview.category] ?? preview.category}
      </span>
      {media &&
        (message && tenantId ? (
          <MessageAttachment
            tenantId={tenantId}
            message={{ ...message, type: preview.header.format.toLowerCase() }}
          />
        ) : (
          <div className="template-media-preview">
            {fileUrl && preview.header.format === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt="Imagen de la plantilla" />
            ) : fileUrl && preview.header.format === 'VIDEO' ? (
              <video src={fileUrl} controls preload="metadata" />
            ) : (
              <>
                {preview.header.format === 'IMAGE' ? (
                  <ImageIcon size={28} />
                ) : preview.header.format === 'VIDEO' ? (
                  <Video size={28} />
                ) : (
                  <FileText size={28} />
                )}
                <span>
                  {file?.name ??
                    (preview.header.format === 'IMAGE'
                      ? 'Agregá una imagen'
                      : preview.header.format === 'VIDEO'
                        ? 'Agregá un video'
                        : 'Agregá un PDF')}
                </span>
              </>
            )}
          </div>
        ))}
      {preview.header.format === 'TEXT' && (
        <strong className="template-preview-header">{preview.header.text}</strong>
      )}
      <p>{formattedText(preview.body)}</p>
      {preview.footer && <small className="template-preview-footer">{preview.footer}</small>}
      {preview.buttons.length > 0 && (
        <div className="template-preview-buttons">
          {preview.buttons.map((button) => (
            <span key={button.index}>
              {button.type === 'URL' ? (
                <ExternalLink size={14} />
              ) : button.type === 'PHONE_NUMBER' ? (
                <Phone size={14} />
              ) : (
                <CornerUpLeft size={14} />
              )}
              {button.text}
            </span>
          ))}
        </div>
      )}
      <small className="template-preview-name">
        {preview.name.replaceAll('_', ' ')} · {templateLanguageLabel(preview.language)}
      </small>
    </div>
  );
}
