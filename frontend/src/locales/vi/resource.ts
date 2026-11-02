import { ResourceLanguage } from 'i18next';
import common from '@/locales/vi/common.json';
import bucketPicker from '@/locales/vi/components/inputs/bucketPicker.json';
import inputs from '@/locales/vi/components/inputs/inputs.json';
import connectionProfiles from '@/locales/vi/components/layouts/navbar/connectionProfiles.json';
import objectDetailDrawer from '@/locales/vi/components/layouts/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/vi/components/layouts/tab/tabLayout.json';
import downloaderWindow from '@/locales/vi/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/vi/components/layouts/transfer/uploaderWindow.json';
import confirmModal from '@/locales/vi/components/modals/confirmModal.json';
import connectModal from '@/locales/vi/components/modals/connectModal.json';
import credentialExpiring from '@/locales/vi/components/modals/credentialExpiring.json';
import historyModal from '@/locales/vi/components/modals/historyModal.json';
import settingModal from '@/locales/vi/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/vi/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/vi/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/vi/messages/ipcMessage.json';
import validateMessage from '@/locales/vi/messages/validateMessage.json';
import bucketPage from '@/locales/vi/pages/bucket/page.json';
import objectPage from '@/locales/vi/pages/object/page.json';

const vietnameseResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  credentialExpiring: credentialExpiring,
  confirmModal: confirmModal,
  historyModal: historyModal,
  settingModal: settingModal,
  uploadLimitModal: uploadLimitModal,
  uploadPickerModal: uploadPickerModal,
  bucketPicker: bucketPicker,
  connectionProfiles: connectionProfiles,
  bucket: {
    page: bucketPage,
  },
  object: {
    page: objectPage,
  },
  inputs: inputs,
  downloaderWindow: downloaderWindow,
  objectDetailDrawer: objectDetailDrawer,
  tabLayout: tabLayout,
  uploaderWindow: uploaderWindow,
};
export default vietnameseResource;
