import { ResourceLanguage } from 'i18next';
import inputs from '@/locales/vi/components/inputs.json';
import confirmModal from '@/locales/vi/components/modals/confirmModal.json';
import connectModal from '@/locales/vi/components/modals/connectModal.json';
import connectionProfiles from '@/locales/vi/components/navbar/connectionProfiles.json';
import ipcMessage from '@/locales/vi/messages/ipcMessage.json';
import validateMessage from '@/locales/vi/messages/validateMessage.json';
import bucketPage from '@/locales/vi/pages/bucket/page.json';

const vietnameseResource: ResourceLanguage = {
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  confirmModal: confirmModal,
  connectionProfiles: connectionProfiles,
  bucket: {
    page: bucketPage,
  },
  inputs: inputs,
};
export default vietnameseResource;
