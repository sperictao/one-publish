# Separate remote-file delivery adapters by protocol

SFTP, SMB, WebDAV, FTPS, and HTTP upload are separate delivery-destination adapters grouped under one remote-file-server category. They may share internal transfer modules, but authentication, reachability, resumability, atomic rename, overwrite, and directory semantics remain explicit capabilities instead of branches inside one universal file-server adapter; SFTP is the first implementation.
