import { ResourceLanguage } from 'i18next';
import inputs from '@/locales/ja/components/inputs.json';
import confirmModal from '@/locales/ja/components/modals/confirmModal.json';
import connectModal from '@/locales/ja/components/modals/connectModal.json';
import connectionProfiles from '@/locales/ja/components/navbar/connectionProfiles.json';
import ipcMessage from '@/locales/ja/messages/ipcMessage.json';
import validateMessage from '@/locales/ja/messages/validateMessage.json';

const japaneseResource: ResourceLanguage = {
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  confirmModal: confirmModal,
  connectionProfiles: connectionProfiles,
  inputs: inputs,
};
export default japaneseResource;
