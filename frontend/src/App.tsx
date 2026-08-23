import { createTheme, MantineProvider } from '@mantine/core';

const App = () => {
  const theme = createTheme({});
  return <MantineProvider theme={theme}></MantineProvider>;
};
export default App;
