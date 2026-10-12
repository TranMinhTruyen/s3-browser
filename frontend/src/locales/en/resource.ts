import { ResourceLanguage } from 'i18next';
import inputs from '@/locales/en/components/inputs.json';
import confirmModal from '@/locales/en/components/modals/confirmModal.json';
import connectModal from '@/locales/en/components/modals/connectModal.json';
import connectionProfiles from '@/locales/en/components/navbar/connectionProfiles.json';
import ipcMessage from '@/locales/en/messages/ipcMessage.json';
import validateMessage from '@/locales/en/messages/validateMessage.json';
import bucketPage from '@/locales/en/pages/bucket/page.json';

const englishResource: ResourceLanguage = {
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
export default englishResource;
