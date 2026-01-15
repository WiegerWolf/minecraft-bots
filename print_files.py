#!/usr/bin/python3

import os
import fnmatch
import sys
import glob
import argparse

# Read the .gitignore file and parse the patterns
def read_gitignore(gitignore_path=".gitignore"):
    patterns = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    patterns.append(line)
    return patterns

# Check if a file or directory matches any pattern in .gitignore or additional patterns
def is_ignored(path, patterns):
    for pattern in patterns:
        if fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(path, f"*/{pattern}"):
            return True
    print(f"{path}")
    return False

# Read file contents with fallback encoding
def read_file_contents(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except UnicodeDecodeError:
        with open(file_path, "r", encoding="latin-1") as f:
            return f.read()

# Traverse directories and write file contents to output
def write_files_to_output(root_dir=".", output_file="output.txt", additional_patterns=None, wildcard_files=None):
    if additional_patterns is None:
        additional_patterns = []
    if wildcard_files is None:
        wildcard_files = []
    
    patterns = read_gitignore()
    patterns.extend(additional_patterns)
    
    with open(output_file, "w") as out:
        # Process wildcard files first
        for wildcard_file in wildcard_files:
            if not is_ignored(wildcard_file, patterns):
                out.write(f"{wildcard_file}\n")
                file_contents = read_file_contents(wildcard_file)
                out.write(file_contents)
                out.write("\n\n")
        
        # Now traverse directories
        for root, dirs, files in os.walk(root_dir):
            # Exclude directories listed in .gitignore or additional patterns
            dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), patterns)]
            for file in files:
                file_path = os.path.join(root, file)
                # Exclude files listed in .gitignore or additional patterns
                if not is_ignored(file_path, patterns):
                    out.write(f"{file_path}\n")
                    file_contents = read_file_contents(file_path)
                    out.write(file_contents)
                    out.write("\n\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Traverse directories and concatenate file contents into an output file.")
    parser.add_argument("root_directory", nargs="?", default=".", help="Root directory to start traversing from.")
    parser.add_argument("wildcard_patterns", nargs="*", help="Wildcard patterns to include specific files.")
    parser.add_argument("-o", "--output", default="output.txt", help="Output file to write the concatenated contents. Default is 'output.txt'.")

    args = parser.parse_args()

    root_directory = args.root_directory
    wildcard_patterns = args.wildcard_patterns
    output_file = args.output

    # Resolve wildcard patterns to file paths
    wildcard_files = []
    for pattern in wildcard_patterns:
        wildcard_files.extend(glob.glob(pattern))

    additional_patterns = [
        ".git",
        ".gitignore",
        "*.py",
        "*.lock",
        "*.lockb",
        "*.png",
        "*.jpg",
        "*.jpeg",
        "*.ico",
        "*.gif",
        "*.svg",
        "*.pdf",
        "*.doc",
        "*.docx",
        "*.sqlite*",
        "*.ppt",
        "*.pptx",
        "*-lock.json",
        ".devcontainer",
        ".vscode",
        "node_modules",
        "prisma/migrations",
        ".next",
    ]
    
    write_files_to_output(root_directory, output_file=output_file, additional_patterns=additional_patterns, wildcard_files=wildcard_files)