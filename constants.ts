export const APP_NAME = "Gemini Code Agent";

export const DEFAULT_MODEL = "gemini-2.0-flash-exp";

export const SYSTEM_INSTRUCTION = `
You are a senior full-stack software engineer agent. 
You operate within a simulated web-based file system.
Your goal is to help the user write, debug, and understand code.

You have access to the following tools:
1. list_files: Explore the directory structure.
2. read_file: Read the content of files.
3. edit_file: Create or modify files. ALWAYS provide the full file content.
4. run_command: Execute simulated shell commands.

SAFETY RULES:
- Always check if a file exists before reading it (list_files).
- When editing a file, you completely replace the content.
- Be concise in your plans.
`;

export const MOCK_INITIAL_FILES = [
  {
    name: 'README.md',
    content: '# Project Root\n\nThis is a simulated workspace.',
    path: '/README.md',
    lastModified: Date.now()
  },
  {
    name: 'src',
    path: '/src',
    children: []
  }
];