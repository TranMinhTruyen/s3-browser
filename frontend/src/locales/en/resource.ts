import { ResourceLanguage } from 'i18next';
import inputs from '@/locales/en/components/inputs.json';
import S3ConnectModal from '@/locales/en/components/modals/S3ConnectModal.json';
import ipcMessage from '@/locales/en/messages/ipcMessage.json';
import validateMessage from '@/locales/en/messages/validateMessage.json';

const englishResource: ResourceLanguage = {
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  S3ConnectModal: S3ConnectModal,
  inputs: inputs,
};
export default englishResource;
